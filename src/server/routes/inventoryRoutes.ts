import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { FieldValue } from '../db/firestore';
import Decimal from 'decimal.js';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { getDb, validateWorkspaceMember, assertPeriodOpen, validateWorkspaceAccounts } from '../db/firestore';
import { formatTzDate, getLocalDateISO } from '../../lib/utils';
import { z } from 'zod';
import { requireWorkspaceRole } from './workspaceRoutes';
import { adjustStock, StockAdjustmentError } from '../services/stockAdjustmentService';
import { setNegativeStockPolicy } from '../services/stockPolicyService';
import { stockMovesReady, writeStockMoves } from '../services/stockMoveService';
import { transferStock } from '../services/stockTransferService';
import { revalueStock, StockRevaluationError } from '../services/stockRevaluationService';
import { landedCostRouter } from './landedCostRoutes';
import { DeliveryError, deliverOrder, returnDelivered, setGoodsLeaveWith, undoDelivery } from '../services/deliveryService';
import { LedgerPostingError } from '../services/cogsStockService';
import { DELIVERY_ID, RETURN_ID } from '../../lib/deliveries';
import { generateDeliveryNotePdf, layoutDeliveryNote } from '../services/deliveryNotePdf';
import { registerStockClosingRoutes } from './stockClosingRoutes';
import type { Estimate, Transaction as LedgerTransaction } from '../../types';

/** Who may change stock or record its cost (viewers read only). */
const STOCK_ROLES = ['owner', 'accountant', 'bookkeeper'];

export const inventoryRouter = express.Router();
// EG-7: the stock closing of a locked period, and the stock invariant checks
registerStockClosingRoutes(inventoryRouter);
// EG-6: landed cost (post, undo), owners and accountants
inventoryRouter.use('/landed-cost', landedCostRouter);

/**
 * Recognizes COGS for a sale. Reduces quantity on hand.
 */
inventoryRouter.post('/cogs', requireWorkspaceRole(STOCK_ROLES), async (req, res) => {
  try {
    const { workspaceId, itemId, quantitySold, inventoryAccountId, cogsAccountId, date } = req.body;
    const user = requestUser(req);
    const db = getDb();
    
    if (!workspaceId || !itemId || !quantitySold || !inventoryAccountId || !cogsAccountId) {
      return res.status(400).json({ error: "Missing required fields (workspaceId, itemId, quantitySold, inventoryAccountId, cogsAccountId)." });
    }

    if (!Number.isInteger(quantitySold) || quantitySold <= 0) {
      return res.status(400).json({ error: "quantitySold must be a positive integer." });
    }

    // 1. Validate workspace membership FIRST (#82)
    const { data: wsData } = await validateWorkspaceMember(db, workspaceId, user);

    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (idempotencyKey) {
      const idempDoc = await db.collection('idempotencyKeys').doc(`${workspaceId}_inv_${idempotencyKey}`).get();
      if (idempDoc.exists) {
        return res.json(idempDoc.data()?.response);
      }
    }

    const txDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getLocalDateISO();

    // 2. Validate period lock
    await assertPeriodOpen(db, workspaceId, txDate, user.uid);

    // 3. Validate accounts exist and belong to workspace
    const accountMap = await validateWorkspaceAccounts(db, workspaceId, [inventoryAccountId, cogsAccountId]);
    const inventoryAcc = accountMap.get(inventoryAccountId)!;
    const cogsAcc = accountMap.get(cogsAccountId)!;

    // 4. Fetch the real inventory item from Firestore
    const itemDoc = await db.collection('inventory').doc(itemId).get();
    if (!itemDoc.exists) {
      return res.status(404).json({ error: `Inventory item ${itemId} not found.` });
    }
    const itemData = itemDoc.data() || {};
    
    // Fail-closed ownership check
    if (!itemData.workspaceId || itemData.workspaceId !== workspaceId) {
      return res.status(403).json({ error: 'Security Violation: Item not found in workspace.' });
    }

    if (typeof itemData.unitCostCents !== 'number' || itemData.unitCostCents <= 0) {
      return res.status(400).json({ error: `Inventory item ${itemId} has no valid unitCostCents configured.` });
    }

    // #76 - Use Decimal for COGS precision
    const unitCostDec = new Decimal(itemData.unitCostCents);
    const totalCogsDec = unitCostDec.mul(quantitySold);
    const totalCogsCents = totalCogsDec.round().toNumber();
    
    const itemName = itemData.name || itemData.sku || itemId;

    const tx = {
      id: db.collection("transactions").doc().id,
      workspaceId,
      uid: user.uid,
      date: txDate,
      description: `Inventory COGS Recognition: ${itemName} (Qty: ${quantitySold})`,
      totalAmountCents: totalCogsCents,
      currency: String(wsData?.currency || 'USD'),
      type: 'journal' as const,
      status: 'approved' as const,
      isCleared: true,
      createdAt: new Date().toISOString(),
      lines: [
        {
          id: `line-1`,
          accountId: cogsAccountId,
          accountName: cogsAcc.name,
          amountCents: totalCogsCents, // Debit Expense
          description: `Recognize COGS for ${quantitySold} units of ${itemName}`
        },
        {
          id: `line-2`,
          accountId: inventoryAccountId,
          accountName: inventoryAcc.name,
          amountCents: -totalCogsCents, // Credit Asset
          description: `Reduce inventory asset for ${quantitySold} units of ${itemName}`
        }
      ]
    };

    // Validate through canonical transaction validator (#102-R)
    const validatedTx = await TransactionValidator.validateAndPrepare(tx, {
      workspaceId,
      user: { uid: user.uid, admin: user.admin },
      wsData
    });

    const responsePayload = {
      status: 'ok',
      message: 'Inventory COGS recorded successfully.',
      transactionId: validatedTx.id,
      unitCostCents: itemData.unitCostCents,
      totalCogsCents
    };

    let resultResponse = responsePayload;

    await stockMovesReady(db);
    await db.runTransaction(async (t: any) => {
      // Re-fetch item inside transaction for race-condition safety
      const itemSnap = await t.get(db.collection('inventory').doc(itemId));
      const currentItemData = itemSnap.data();
      const currentQty = typeof currentItemData?.quantityAtHand === 'number' ? currentItemData.quantityAtHand : 0;
      
      if (quantitySold > currentQty) {
        throw new Error(`Insufficient inventory stock. Requested ${quantitySold}, available ${currentQty}.`);
      }

      if (idempotencyKey) {
        const idempRef = db.collection('idempotencyKeys').doc(`${workspaceId}_inv_${idempotencyKey}`);
        const idempSnap = await t.get(idempRef);
        if (idempSnap.exists) {
          resultResponse = idempSnap.data()?.response || responsePayload;
          return;
        }
      }

      const txRef = db.collection('transactions').doc(validatedTx.id);
      t.set(txRef, { ...validatedTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      
      // Reduce on-hand inventory quantity
      const itemRef = db.collection('inventory').doc(itemId);
      t.update(itemRef, {
        quantityAtHand: FieldValue.increment(-quantitySold),
        updatedAt: FieldValue.serverTimestamp()
      });
      // W-02: the change in the item's stock history
      writeStockMoves(db, t, [{
        workspaceId, itemId, itemName: String(itemName), date: txDate, kind: 'manual-cogs',
        quantity: -quantitySold, quantityBefore: currentQty, quantityAfter: currentQty - quantitySold,
        unitCostCents: itemData.unitCostCents, valueCents: -totalCogsCents, transactionId: validatedTx.id, uid: user.uid,
      }]);

      if (idempotencyKey) {
        const idempRef = db.collection('idempotencyKeys').doc(`${workspaceId}_inv_${idempotencyKey}`);
        t.set(idempRef, {
          response: responsePayload,
          timestamp: new Date().toISOString(),
          workspaceId
        });
      }
    });

    res.json(resultResponse);
  } catch (e) {
    res.status(errorMessage(e).includes('Unauthorized') ? 403 : 400).json({ error: errorMessage(e) });
  }
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AdjustSchema = z.object({
  workspaceId: z.string().min(1),
  itemId: z.string().min(1),
  quantityChange: z.number().finite().refine(n => n !== 0, 'Enter a quantity to add or remove'),
  unitCostCents: z.number().int().nonnegative().optional(),
  inventoryAccountId: z.string().min(1),
  offsetAccountId: z.string().min(1),
  type: z.enum(['purchase', 'opening', 'adjustment']).default('adjustment'),
  reason: z.string().max(200).optional(),
  date: date.optional(),
  locationId: z.string().trim().max(200).optional(),
});
const CountSchema = z.object({
  workspaceId: z.string().min(1),
  inventoryAccountId: z.string().min(1),
  offsetAccountId: z.string().min(1),
  reason: z.string().max(200).optional(),
  date: date.optional(),
  locationId: z.string().trim().max(200).optional(),
  counts: z.array(z.object({ itemId: z.string().min(1), counted: z.number().finite().nonnegative() })).min(1).max(2000),
});

async function stockRequest(req: express.Request, res: express.Response, kind: 'single' | 'count') {
  try {
    const user = requestUser(req);
    const db = getDb();
    const parsed = (kind === 'single' ? AdjustSchema : CountSchema).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields', details: parsed.error.issues });
    const body = parsed.data;
    const { data: wsData } = await validateWorkspaceMember(db, body.workspaceId, user);
    const txDate = body.date || formatTzDate(new Date(), typeof wsData?.timezone === 'string' ? wsData.timezone : 'UTC');
    const result = await adjustStock(db, {
      workspaceId: body.workspaceId, user: { uid: user.uid, admin: user.admin }, wsData, date: txDate,
      inventoryAccountId: body.inventoryAccountId, offsetAccountId: body.offsetAccountId, reason: body.reason,
      ...(body.locationId ? { locationId: body.locationId } : {}),
      ...('counts' in body
        ? { kind: 'count' as const, changes: body.counts }
        : { kind: body.type, changes: [{ itemId: body.itemId, quantityChange: body.quantityChange, unitCostCents: body.unitCostCents }] }),
    });
    res.json({ status: 'ok', ...result, ...(result.items.length === 1 ? { newQuantity: result.items[0].after } : {}) });
  } catch (e) {
    if (e instanceof StockAdjustmentError) return res.status(e.status).json({ error: e.message });
    res.status(/Unauthorized|not a member/i.test(errorMessage(e)) ? 403 : 400).json({ error: errorMessage(e) });
  }
}

/**
 * Adds or removes stock of one item with the books (K-13 BA-04): a purchase (recalculates the
 * average cost), opening stock or an adjustment (damaged, lost, found). Owners, accountants and
 * bookkeepers. stockAdjustmentService.ts posts the entry and changes the quantity together.
 */
inventoryRouter.post('/adjust', requireWorkspaceRole(STOCK_ROLES), (req, res) => stockRequest(req, res, 'single'));

/** A stock count (W-04 W-05): the counted quantities; differences go to the offset (variance) account in one entry. */
inventoryRouter.post('/count', requireWorkspaceRole(STOCK_ROLES), (req, res) => stockRequest(req, res, 'count'));

const RevalueSchema = z.object({
  workspaceId: z.string().min(1),
  itemId: z.string().min(1),
  newUnitCostCents: z.number().int().nonnegative(),
  inventoryAccountId: z.string().min(1),
  offsetAccountId: z.string().min(1),
  reason: z.string().trim().min(1, 'Say why the cost changes').max(200),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'A revaluation needs a request id'),
  date: date.optional(),
});

/**
 * ISS-130: revalues the stock on hand of one item to a new unit cost. The difference in value is posted to the
 * Inventory account against the chosen offset account in the same database transaction that changes the cost
 * (stockRevaluationService.ts). Owners and accountants: it changes book value without moving any stock.
 */
inventoryRouter.post('/revalue', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  try {
    const user = requestUser(req);
    const db = getDb();
    const parsed = RevalueSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields', details: parsed.error.issues });
    const body = parsed.data;
    const { data: wsData } = await validateWorkspaceMember(db, body.workspaceId, user);
    const txDate = body.date || formatTzDate(new Date(), typeof wsData?.timezone === 'string' ? wsData.timezone : 'UTC');
    const result = await revalueStock(db, {
      workspaceId: body.workspaceId, user: { uid: user.uid, admin: user.admin }, wsData, date: txDate,
      itemId: body.itemId, newUnitCostCents: body.newUnitCostCents, inventoryAccountId: body.inventoryAccountId,
      offsetAccountId: body.offsetAccountId, reason: body.reason, requestId: body.requestId,
    });
    res.json({ status: 'ok', ...result });
  } catch (e) {
    if (e instanceof StockRevaluationError) return res.status(e.status).json({ error: e.message });
    res.status(/Unauthorized|not a member/i.test(errorMessage(e)) ? 403 : 400).json({ error: errorMessage(e) });
  }
});

/** W-06: an owner chooses whether a sale may take stock below zero (stockPolicyService.ts). */
inventoryRouter.put('/stock-policy', requireWorkspaceRole(['owner']), async (req, res) => {
  try {
    // BF-08 step 2: or when stock leaves (with the invoice, or with a delivery)
    const leave = z.object({ workspaceId: z.string().min(1), goodsLeaveWith: z.enum(['invoice', 'delivery']) }).strict().safeParse(req.body);
    const user = requestUser(req);
    if (leave.success) return res.json({ status: 'ok', ...(await setGoodsLeaveWith(getDb(), { workspaceId: leave.data.workspaceId, uid: user.uid, email: user.email, value: leave.data.goodsLeaveWith })) });
    const parsed = z.object({ workspaceId: z.string().min(1), refuseNegativeStock: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say whether to refuse sales beyond stock (true or false), or when stock leaves (invoice or delivery)' });
    res.json({ status: 'ok', ...(await setNegativeStockPolicy(getDb(), { workspaceId: parsed.data.workspaceId, uid: user.uid, email: user.email, refuse: parsed.data.refuseNegativeStock })) });
  } catch (e) {
    if (e instanceof StockAdjustmentError || e instanceof DeliveryError) return res.status(e.status).json({ error: e.message });
    res.status(400).json({ error: errorMessage(e) });
  }
});

/** BF-08 step 2: deliver items from an order (deliveryService.ts): stock leaves and its cost is booked, once. */
inventoryRouter.post('/deliveries', requireWorkspaceRole(STOCK_ROLES), async (req, res) => {
  try {
    const parsed = z.object({
      workspaceId: z.string().min(1), orderId: z.string().min(1), deliveryId: z.string().regex(DELIVERY_ID, 'Unknown delivery id'), date,
      lines: z.array(z.object({ position: z.number().int().min(0), quantity: z.number().finite() }).strict()).min(1).max(500),
      inventoryAccountId: z.string().min(1), cogsAccountId: z.string().min(1),
      locationId: z.string().trim().max(200).optional(), note: z.string().max(200).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields' });
    const user = requestUser(req);
    const { locationId, ...rest } = parsed.data;
    res.json({ status: 'ok', ...(await deliverOrder(getDb(), { ...rest, ...(locationId ? { locationId } : {}), uid: user.uid, email: user.email })) });
  } catch (e) {
    if (e instanceof DeliveryError || e instanceof LedgerPostingError) return res.status(e.status).json({ error: e.message });
    res.status(/locked|closed/i.test(errorMessage(e)) ? 409 : 400).json({ error: errorMessage(e) });
  }
});

/** M-12: the delivery note of one delivery, as a PDF to go with the goods (deliveryNotePdf.ts). */
inventoryRouter.get('/deliveries/:deliveryId/note', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), async (req, res) => {
  try {
    const { deliveryId } = req.params as Record<string, string>;
    const workspaceId = String(req.query.workspaceId || '');
    const orderId = String(req.query.orderId || '');
    if (!DELIVERY_ID.test(deliveryId) || !workspaceId || !orderId) return res.status(400).json({ error: 'Say which delivery' });
    const db = getDb();
    const orderSnap = await db.collection('estimates').doc(orderId).get();
    const order = orderSnap.exists ? ({ ...orderSnap.data(), id: orderSnap.id } as Estimate) : null;
    if (!order || order.workspaceId !== workspaceId) return res.status(404).json({ error: 'Order not found' });
    const entries = (await db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.orderId', '==', orderId).get()).docs
      .map(d => ({ ...d.data(), id: d.id }) as LedgerTransaction);
    const ws = (await db.collection('workspaces').doc(workspaceId).get()).data() || {};
    const layout = layoutDeliveryNote(order, entries, deliveryId, { name: ws.name });
    if (!layout) return res.status(404).json({ error: 'That delivery is not on this order, or it was undone' });
    const pdf = await generateDeliveryNotePdf(layout);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="delivery_note_${layout.order.replace(/[^\w.-]+/g, '_')}_${layout.date}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

/** BF-08: goods that came back after a delivery (deliveryService.returnDelivered). */
inventoryRouter.post('/deliveries/returns', requireWorkspaceRole(STOCK_ROLES), async (req, res) => {
  try {
    const parsed = z.object({
      workspaceId: z.string().min(1), orderId: z.string().min(1), returnId: z.string().regex(RETURN_ID, 'Unknown return id'), date,
      lines: z.array(z.object({ position: z.number().int().min(0), quantity: z.number().finite() }).strict()).min(1).max(500),
      inventoryAccountId: z.string().min(1), cogsAccountId: z.string().min(1), note: z.string().max(200).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields' });
    const user = requestUser(req);
    res.json({ status: 'ok', ...(await returnDelivered(getDb(), { ...parsed.data, uid: user.uid, email: user.email })) });
  } catch (e) {
    if (e instanceof DeliveryError || e instanceof LedgerPostingError) return res.status(e.status).json({ error: e.message });
    res.status(/locked|closed/i.test(errorMessage(e)) ? 409 : 400).json({ error: errorMessage(e) });
  }
});

/** BF-08 step 2: undo a delivery: its entries are reversed and the units come back. */
inventoryRouter.post('/deliveries/:deliveryId/undo', requireWorkspaceRole(STOCK_ROLES), async (req, res) => {
  try {
    const { deliveryId } = req.params as Record<string, string>;
    const parsed = z.object({ workspaceId: z.string().min(1), orderId: z.string().min(1), date }).strict().safeParse(req.body);
    if (!parsed.success || !DELIVERY_ID.test(deliveryId)) return res.status(400).json({ error: parsed.success ? 'Unknown delivery id' : parsed.error.issues[0]?.message || 'Check the fields' });
    const user = requestUser(req);
    res.json({ status: 'ok', ...(await undoDelivery(getDb(), { ...parsed.data, deliveryId, uid: user.uid, email: user.email })) });
  } catch (e) {
    if (e instanceof DeliveryError || e instanceof LedgerPostingError) return res.status(e.status).json({ error: e.message });
    res.status(/locked|closed/i.test(errorMessage(e)) ? 409 : 400).json({ error: errorMessage(e) });
  }
});

/** W-01: move units of an item between locations (stockTransferService.ts); nothing is posted. */
inventoryRouter.post('/transfer', requireWorkspaceRole(STOCK_ROLES), async (req, res) => {
  try {
    const parsed = z.object({
      workspaceId: z.string().min(1), itemId: z.string().min(1), from: z.string().trim().max(200), to: z.string().trim().max(200),
      quantity: z.number().positive().finite(), date, note: z.string().max(200).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields' });
    const user = requestUser(req);
    res.json({ status: 'ok', ...(await transferStock(getDb(), { ...parsed.data, uid: user.uid, email: user.email })) });
  } catch (e) {
    if (e instanceof StockAdjustmentError) return res.status(e.status).json({ error: e.message });
    res.status(/locked|closed/i.test(errorMessage(e)) ? 409 : 400).json({ error: errorMessage(e) });
  }
});
