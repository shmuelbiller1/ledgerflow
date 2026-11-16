/**
 * Stock (K-13 BA-04, BF-08, EG-6, EG-7, ISS-130, W-01 W-04 W-05 W-06). Every write below is a
 * registered command (src/server/commands/inventory.ts): the handlers keep their established
 * `{ status: 'ok' }` / `{ error }` wire shapes and hand the work to the command runner, which
 * checks the workspace, the role and the period lock and runs the write in one transaction with
 * its audit line. Reads (the delivery note PDF, the stock closing report, the landed-cost plan)
 * stay here.
 */
import express from 'express';
import { z } from 'zod';
import { errorMessage, requestUser } from '../auth/requestUser';
import { getDb } from '../db/firestore';
import type { AuthenticatedRequest } from './workspaceRoutes';
import { DELIVERY_ID } from '../../lib/deliveries';
import { generateDeliveryNotePdf, layoutDeliveryNote } from '../services/deliveryNotePdf';
import { landedCostRouter } from './landedCostRoutes';
import { registerStockClosingRoutes } from './stockClosingRoutes';
import {
  inventoryAdjustCommand,
  inventoryAdjustInput,
  inventoryCogsCommand,
  inventoryCogsInput,
  inventoryCountCommand,
  inventoryCountInput,
  inventoryDeliverCommand,
  inventoryDeliverInput,
  inventoryReturnCommand,
  inventoryReturnInput,
  inventoryRevalueCommand,
  inventoryRevalueInput,
  inventoryStockPolicyCommand,
  inventoryStockPolicyInput,
  inventoryTransferCommand,
  inventoryTransferInput,
  inventoryUndoDeliveryCommand,
  inventoryUndoDeliveryInput,
} from '../commands/inventory';
import type { CommandExecutionOutcome } from '../commands/types';
import type { CommandRunnerDependencies } from '../utils/commandExecutor';
import type { Estimate, Transaction as LedgerTransaction } from '../../types';

/**
 * The inventory handlers answer `{ error }` (never the command envelope): keep that shape, and the
 * established statuses — a period lock was 409 where the old handler read "locked|closed", a
 * missing role 403, a missing item or account 404, everything else 400.
 */
function stockCommandResponse(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: outcome.data };
  if (outcome.status >= 500) return { status: outcome.status, body: { error: errorMessage(outcome.error ?? outcome.message) } };
  const status = outcome.code === 'PERIOD_LOCKED' ? 409 : outcome.status;
  return { status, body: { error: outcome.message } };
}

/** The workspace of an inventory request: the body's, or the address's where the route passes one. */
const workspaceOf = (req: express.Request): string =>
  String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || '') || String((req.params as Record<string, string>)?.workspaceId || '');

/** The legacy writes answer `{ status: 'ok', ...result }`; refusals keep `{ error }`. */
function okBody(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } };
  const formatted = stockCommandResponse(outcome);
  // a landed cost refused because its plan changed answers the new plan to review, as it did before
  const plan = (outcome.error as { plan?: unknown } | undefined)?.plan;
  return plan ? { status: formatted.status, body: { ...(formatted.body as Record<string, unknown>), plan } } : formatted;
}


/** Factory allows the registered routes to be tested with an isolated command runner database. */
export function createInventoryRouter(dependencies: CommandRunnerDependencies = {}): express.Router {
  const router = express.Router();
  registerStockClosingRoutes(router);
  router.use('/landed-cost', landedCostRouter);

  /** Recognizes COGS for a sale. Reduces quantity on hand. */
  router.post('/cogs', async (req, res) => {
    const input = inventoryCogsInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || 'Check the fields', details: input.error.issues });
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryCogsCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** Adds or removes stock of one item with the books (K-13 BA-04): a purchase, opening stock or an adjustment. */
  router.post('/adjust', async (req, res) => {
    const input = inventoryAdjustInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || 'Check the fields', details: input.error.issues });
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryAdjustCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** A stock count (W-04 W-05): the counted quantities; differences go to the variance account in one entry. */
  router.post('/count', async (req, res) => {
    const input = inventoryCountInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || 'Check the fields', details: input.error.issues });
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryCountCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** ISS-130: revalues the stock on hand of one item to a new unit cost. Owners and accountants. */
  router.post('/revalue', async (req, res) => {
    const input = inventoryRevalueInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || 'Check the fields', details: input.error.issues });
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryRevalueCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** W-06, BF-08 step 2: the stock policy (refuse sales beyond stock) and when stock leaves. Owners. */
  router.put('/stock-policy', async (req, res) => {
    const input = inventoryStockPolicyInput.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: 'Say whether to refuse sales beyond stock (true or false), or when stock leaves (invoice or delivery)' });
    }
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryStockPolicyCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** BF-08 step 2: deliver items from an order: stock leaves and its cost is booked, once. */
  router.post('/deliveries', async (req, res) => {
    const input = inventoryDeliverInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || 'Check the fields' });
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryDeliverCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** M-12: the delivery note of one delivery, as a PDF to go with the goods. Read only. */
  router.get('/deliveries/:deliveryId/note', async (req, res) => {
    try {
      const { deliveryId } = req.params as Record<string, string>;
      const workspaceId = String(req.query.workspaceId || '');
      const orderId = String(req.query.orderId || '');
      if (!DELIVERY_ID.test(deliveryId) || !workspaceId || !orderId) return res.status(400).json({ error: 'Say which delivery' });
      const db = (dependencies.getDb || getDb)();
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

  /** BF-08: goods that came back after a delivery. */
  router.post('/deliveries/returns', async (req, res) => {
    const input = inventoryReturnInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || 'Check the fields' });
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryReturnCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** BF-08 step 2: undo a delivery: its entries are reversed and the units come back. */
  router.post('/deliveries/:deliveryId/undo', async (req, res) => {
    const deliveryId = String((req.params as Record<string, string>).deliveryId || '');
    const input = inventoryUndoDeliveryInput.safeParse({ ...(req.body as Record<string, unknown>), deliveryId });
    if (!input.success) {
      const badId = !DELIVERY_ID.test(deliveryId);
      return res.status(400).json({ error: badId ? 'Unknown delivery id' : input.error.issues[0]?.message || 'Check the fields' });
    }
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryUndoDeliveryCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  /** W-01: move units of an item between locations; nothing is posted. */
  router.post('/transfer', async (req, res) => {
    const input = inventoryTransferInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || 'Check the fields' });
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryTransferCommand),
      workspaceId: workspaceOf(req), input: input.data, formatResponse: okBody,
    }, dependencies);
  });

  return router;
}

export const inventoryRouter = createInventoryRouter();
