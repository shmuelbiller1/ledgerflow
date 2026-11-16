import { z } from 'zod';
import { formatTzDate } from '../../lib/calendarDate';
import { cogsInTransaction, prepareCogs, type CogsAccounts, type CogsResult } from '../services/cogsRecognitionService';
import { adjustStockInTransaction, prepareAdjustStock, type StockAdjustmentAccounts } from '../services/stockAdjustmentService';
import { prepareRevalueStock, revalueStockInTransaction, type StockRevaluationResult, type StockRevaluationSetup } from '../services/stockRevaluationService';
import type { CommandDefinition } from './types';

/**
 * The stock writes that move a quantity with their entry (K-13 BA-04, W-04 W-05, ISS-130):
 * recognizing the cost of what was sold, adding or removing stock, a count, and a revaluation.
 * `inventory.ts` re-exports them with the rest of the stock commands.
 */

export const STOCK_ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The workspace-local date the legacy routes defaulted to. */
export const todayIn = (workspace: Record<string, unknown>) =>
  formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');

// --------------------------------------------------------------------------- inventory.cogs

export const inventoryCogsInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  itemId: z.string().min(1),
  quantitySold: z.number().int().positive('quantitySold must be a positive integer.'),
  inventoryAccountId: z.string().min(1),
  cogsAccountId: z.string().min(1),
  date: DAY.optional(),
}).strict();
type InventoryCogsInput = z.output<typeof inventoryCogsInput>;

const cogsFor = (ctx: { workspaceId: string; actor: string; email?: string; user: { admin?: boolean }; workspace: Record<string, unknown> }, input: InventoryCogsInput) => ({
  workspaceId: ctx.workspaceId,
  uid: ctx.actor,
  email: ctx.email,
  admin: ctx.user.admin,
  wsData: ctx.workspace,
  itemId: input.itemId,
  quantitySold: input.quantitySold,
  inventoryAccountId: input.inventoryAccountId,
  cogsAccountId: input.cogsAccountId,
  date: input.date || todayIn(ctx.workspace),
});

export const inventoryCogsCommand: CommandDefinition<typeof inventoryCogsInput, CogsResult, CogsAccounts> = {
  name: 'inventory.cogs',
  input: inventoryCogsInput,
  roles: STOCK_ROLES,
  dated: 'date',
  // the legacy route's operation type and key prefix, so an in-flight retry still replays
  operationType: 'INVENTORY_COGS',
  legacyKey: (workspaceId, operationId) => `${workspaceId}_inv_${operationId}`,
  async prepare(ctx, input: InventoryCogsInput) {
    return prepareCogs(ctx.db, cogsFor(ctx, input));
  },
  async handler(ctx, tx, input: InventoryCogsInput) {
    return cogsInTransaction(ctx.db, tx, cogsFor(ctx, input), ctx.prepared as CogsAccounts);
  },
  async preview(ctx, input: InventoryCogsInput) {
    const prepared = await prepareCogs(ctx.db, cogsFor(ctx, input));
    const onHand = Number(prepared.item.quantityAtHand) || 0;
    return {
      title: `Recognize cost of goods sold: ${input.quantitySold} × ${prepared.itemName}`,
      lines: [
        `${prepared.cogsAcc.name} (cost of goods sold): ${money(prepared.totalCogsCents)}`,
        `${prepared.inventoryAcc.name} (inventory): −${money(prepared.totalCogsCents)}`,
        `Units on hand: ${onHand} → ${onHand - input.quantitySold}`,
        ...(input.quantitySold > onHand ? [`More than is on hand (${onHand}): this will be refused`] : []),
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'INVENTORY_COGS_RECORDED',
      entityType: 'inventory',
      entityId: '',
      description: `Recognized cost of goods sold of ${money(result.totalCogsCents)}`,
      details: { totalCogsCents: result.totalCogsCents, transactionId: result.transactionId },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Recognize the cost of goods sold for units already sold from one item, lowering the quantity on hand; do not use it to add stock or record a purchase — that is inventory.adjust.',
    example: { itemId: 'item_123', quantitySold: 2, inventoryAccountId: 'acc_inventory', cogsAccountId: 'acc_cogs' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A field is missing, the quantity is not a positive whole number, or an account is not in this workspace.', next: 'Send the item, a whole quantity above zero, and two accounts of this workspace.' },
      { code: 'NOT_FOUND', when: 'The item is not in this workspace.', next: 'Choose an item of this workspace.' },
      { code: 'CONFLICT', when: 'There are fewer units on hand than the quantity sold.', next: 'Check the quantity on hand, or adjust the stock first.' },
      { code: 'PERIOD_LOCKED', when: 'The date falls in a closed period.', next: 'Use a date in an open period.' },
    ],
  },
};

// --------------------------------------------------------------------------- inventory.adjust / inventory.count

export const inventoryAdjustInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  itemId: z.string().min(1),
  quantityChange: z.number().finite().refine(n => n !== 0, 'Enter a quantity to add or remove'),
  unitCostCents: z.number().int().nonnegative().optional(),
  inventoryAccountId: z.string().min(1),
  offsetAccountId: z.string().min(1),
  type: z.enum(['purchase', 'opening', 'adjustment']).default('adjustment'),
  reason: z.string().max(200).optional(),
  date: DAY.optional(),
  locationId: z.string().trim().max(200).optional(),
}).strict();
type InventoryAdjustInput = z.output<typeof inventoryAdjustInput>;

export const inventoryCountInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  inventoryAccountId: z.string().min(1),
  offsetAccountId: z.string().min(1),
  reason: z.string().max(200).optional(),
  date: DAY.optional(),
  locationId: z.string().trim().max(200).optional(),
  counts: z.array(z.object({ itemId: z.string().min(1), counted: z.number().finite().nonnegative() }).strict()).min(1).max(2000),
}).strict();
type InventoryCountInput = z.output<typeof inventoryCountInput>;

export type StockWriteResult = {
  transactionId: string | null;
  valueCents: number;
  items: Array<{ itemId: string; name: string; before: number; after: number; valueCents: number; unitCostCents: number }>;
  /** One item only: the quantity after the change, as the legacy /adjust and /count answered. */
  newQuantity?: number;
};

type StockContext = { workspaceId: string; actor: string; user: { admin?: boolean }; workspace: Record<string, unknown> };

/** The legacy routes' account/kind mapping: one adjustment, or a count of many items. */
function stockChange(
  ctx: StockContext,
  input: InventoryAdjustInput | InventoryCountInput,
  kind: 'single' | 'count',
) {
  return {
    workspaceId: ctx.workspaceId,
    user: { uid: ctx.actor, admin: ctx.user.admin },
    wsData: ctx.workspace,
    date: input.date || todayIn(ctx.workspace),
    inventoryAccountId: input.inventoryAccountId,
    offsetAccountId: input.offsetAccountId,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.locationId ? { locationId: input.locationId } : {}),
    ...('counts' in input
      ? { kind: 'count' as const, changes: input.counts }
      : {
        kind: (input as InventoryAdjustInput).type,
        changes: [{
          itemId: (input as InventoryAdjustInput).itemId,
          quantityChange: (input as InventoryAdjustInput).quantityChange,
          ...((input as InventoryAdjustInput).unitCostCents !== undefined ? { unitCostCents: (input as InventoryAdjustInput).unitCostCents } : {}),
        }],
      }),
  };
}

function stockCommand<Input extends InventoryAdjustInput | InventoryCountInput>(
  name: `${string}.${string}`,
  inputSchema: z.ZodType<Input>,
  kind: 'single' | 'count',
  sentence: string,
): CommandDefinition<z.ZodType<Input>, StockWriteResult, StockAdjustmentAccounts> {
  return {
    name,
    input: inputSchema,
    roles: STOCK_ROLES,
    dated: 'date',
    async prepare(ctx, input) {
      return prepareAdjustStock(ctx.db, stockChange(ctx, input, kind));
    },
    async handler(ctx, tx, input) {
      const result = await adjustStockInTransaction(ctx.db, tx, stockChange(ctx, input, kind), ctx.prepared as StockAdjustmentAccounts);
      // the legacy route answered the new quantity when one item changed
      return result.items.length === 1 ? { ...result, newQuantity: result.items[0].after } : result;
    },
    async preview(ctx, input) {
      const prepared = await prepareAdjustStock(ctx.db, stockChange(ctx, input, kind));
      const changes = stockChange(ctx, input, kind).changes;
      return {
        title: kind === 'count' ? 'Count the stock' : 'Change stock',
        lines: [
          ...changes.map(change => ('counted' in change && change.counted !== undefined
            ? `${change.itemId}: counted ${change.counted}`
            : `${change.itemId}: ${((change as { quantityChange?: number }).quantityChange || 0) > 0 ? '+' : ''}${(change as { quantityChange?: number }).quantityChange}`)),
          `${prepared.inventoryAcc.name} against ${prepared.offsetAcc.name}`,
          'The entry and the quantities are written together',
        ],
      };
    },
    audit(_input, result) {
      return {
        action: kind === 'count' ? 'STOCK_COUNTED' : 'STOCK_ADJUSTED',
        entityType: 'inventory',
        entityId: result.items[0]?.itemId || '',
        description: `${kind === 'count' ? 'Counted' : 'Changed'} ${result.items.length} item(s): ${money(result.valueCents)}`,
        details: { valueCents: result.valueCents, transactionId: result.transactionId, items: result.items.map(i => ({ itemId: i.itemId, before: i.before, after: i.after })) },
      };
    },
    inverse() { return null; },
    risk: 'normal',
    describe: {
      sentence,
      example: kind === 'count'
        ? { inventoryAccountId: 'acc_inventory', offsetAccountId: 'acc_variance', counts: [{ itemId: 'item_123', counted: 12 }] }
        : { itemId: 'item_123', quantityChange: 5, inventoryAccountId: 'acc_inventory', offsetAccountId: 'acc_cash', type: 'purchase' },
      refusals: [
        { code: 'INVALID_INPUT', when: 'A field is missing, a quantity is zero, or the two accounts are the same.', next: 'Fix the named field; a change is never zero.' },
        { code: 'NOT_FOUND', when: 'An item or an account is not in this workspace.', next: 'Use items and accounts of this workspace.' },
        { code: 'CONFLICT', when: 'The change would take the quantity below zero, or nothing would change.', next: 'Check the quantity on hand first.' },
        { code: 'PERIOD_LOCKED', when: 'The date falls in a closed period.', next: 'Use a date in an open period.' },
      ],
    },
  };
}

export const inventoryAdjustCommand = stockCommand(
  'inventory.adjust',
  inventoryAdjustInput,
  'single',
  'Add or remove the stock of one item with its entry (a purchase, opening stock, or a damaged or found adjustment); do not use it to move units between locations — that is inventory.transfer.',
);

export const inventoryCountCommand = stockCommand(
  'inventory.count',
  inventoryCountInput,
  'count',
  'Record the quantities a stock count found, posting the differences to the chosen variance account in one entry; do not use it to add a purchase.',
);

// --------------------------------------------------------------------------- inventory.revalue

export const inventoryRevalueInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  itemId: z.string().min(1),
  newUnitCostCents: z.number().int().nonnegative(),
  inventoryAccountId: z.string().min(1),
  offsetAccountId: z.string().min(1),
  reason: z.string().trim().min(1, 'Say why the cost changes').max(200),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'A revaluation needs a request id'),
  date: DAY.optional(),
}).strict();
type InventoryRevalueInput = z.output<typeof inventoryRevalueInput>;

const revalueFor = (ctx: { workspaceId: string; actor: string; workspace: Record<string, unknown> }, input: InventoryRevalueInput) => ({
  workspaceId: ctx.workspaceId,
  user: { uid: ctx.actor },
  wsData: ctx.workspace,
  date: input.date || todayIn(ctx.workspace),
  itemId: input.itemId,
  newUnitCostCents: input.newUnitCostCents,
  inventoryAccountId: input.inventoryAccountId,
  offsetAccountId: input.offsetAccountId,
  reason: input.reason,
  requestId: input.requestId,
});

export const inventoryRevalueCommand: CommandDefinition<typeof inventoryRevalueInput, StockRevaluationResult, StockRevaluationSetup> = {
  name: 'inventory.revalue',
  input: inventoryRevalueInput,
  roles: ['owner', 'accountant'],
  dated: 'date',
  async prepare(ctx, input: InventoryRevalueInput) {
    return prepareRevalueStock(ctx.db, revalueFor(ctx, input));
  },
  async handler(ctx, tx, input: InventoryRevalueInput) {
    return revalueStockInTransaction(ctx.db, tx, revalueFor(ctx, input), ctx.prepared as StockRevaluationSetup);
  },
  async preview(ctx, input: InventoryRevalueInput) {
    await prepareRevalueStock(ctx.db, revalueFor(ctx, input));
    const item = (await ctx.db.collection('inventory').doc(input.itemId).get()).data() || {};
    const quantity = Number(item.quantityAtHand) || 0;
    const oldCost = Math.round(Number(item.unitCostCents) || 0);
    return {
      title: `Revalue ${String(item.name || input.itemId)}`,
      lines: [
        `Unit cost: ${money(oldCost)} → ${money(input.newUnitCostCents)}`,
        `${quantity} unit(s) on hand: the value moves by ${money(Math.round((input.newUnitCostCents - oldCost) * quantity))}`,
        'No units move; the difference goes to the chosen gain or loss account',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'STOCK_REVALUED',
      entityType: 'inventory',
      entityId: result.itemId,
      description: `Revalued ${result.name}: ${money(result.oldUnitCostCents)} → ${money(result.newUnitCostCents)} a unit (${money(result.valueCents)})`,
      details: { quantity: result.quantity, valueCents: result.valueCents, transactionId: result.transactionId },
    };
  },
  inverse(_input, result) {
    if (result.replayed) return null;
    return {
      command: 'inventory.revalue',
      input: { itemId: result.itemId, newUnitCostCents: result.oldUnitCostCents, reason: 'Back to the earlier cost' },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Set the cost of the stock on hand to a new unit cost, posting the difference to a gain or loss account; do not use it to change a quantity — that is inventory.adjust.',
    example: { itemId: 'item_123', newUnitCostCents: 1250, inventoryAccountId: 'acc_inventory', offsetAccountId: 'acc_revaluation', reason: 'Supplier price rise', requestId: 'reval-2026-11-01' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The new cost, the reason or the request id is invalid, the date is after today, or an account is the wrong kind.', next: 'Fix the field; a revaluation takes effect from today.' },
      { code: 'NOT_FOUND', when: 'The item or an account is not in this workspace.', next: 'Use items and accounts of this workspace.' },
      { code: 'CONFLICT', when: 'The cost already is that, no stock is on hand, the change is under a cent, or the stock moved after the date.', next: 'Date the revaluation on or after the last stock change.' },
      { code: 'PERIOD_LOCKED', when: 'The date falls in a closed period.', next: 'Use a date in an open period.' },
    ],
  },
};


/** Whole cents as money, the way the screens show it. */
export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
