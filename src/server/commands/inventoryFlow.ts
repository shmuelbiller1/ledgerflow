import { z } from 'zod';
import { DELIVERY_ID, RETURN_ID } from '../../lib/deliveries';
import {
  deliverOrderInTransaction,
  prepareDeliverOrder,
  prepareReturnDelivered,
  prepareUndoDelivery,
  returnDeliveredInTransaction,
  setGoodsLeaveWithInTransaction,
  undoDeliveryInTransaction,
  type DeliveryAccounts,
} from '../services/deliveryService';
import {
  landInTransaction, prepareLandedCost, undoLandedCostInTransaction, type LandedCostInput, type LandedCostUndoInput,
} from '../services/landedCostService';
import { prepareStockClosing, writeStockClosingInTransaction } from '../services/stockClosingService';
import { setNegativeStockPolicyInTransaction } from '../services/stockPolicyService';
import { prepareTransferStock, transferStockInTransaction } from '../services/stockTransferService';
import type { CommandDefinition } from './types';
import { money, todayIn, STOCK_ROLES } from './inventoryStock';

/**
 * The stock settings and the goods that leave (W-06, BF-08, EG-6, EG-7, W-01): the negative-stock
 * policy and when stock leaves, deliveries, returns and their undo, transfers between locations,
 * the stock closing of a locked period, and a landed cost with its undo.
 */

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const groupIdLike = (value: string) => value.trim();

// --------------------------------------------------------------------------- inventory.stockpolicy

export const inventoryStockPolicyInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  refuseNegativeStock: z.boolean().optional(),
  goodsLeaveWith: z.enum(['invoice', 'delivery']).optional(),
}).strict().refine(
  input => (input.refuseNegativeStock === undefined) !== (input.goodsLeaveWith === undefined),
  'Send either refuseNegativeStock (true or false) or goodsLeaveWith (invoice or delivery)',
);
type InventoryStockPolicyInput = z.output<typeof inventoryStockPolicyInput>;

type StockPolicyResult = { refuseNegativeStock: boolean } | { goodsLeaveWith: 'invoice' | 'delivery' };

export const inventoryStockPolicyCommand: CommandDefinition<typeof inventoryStockPolicyInput, StockPolicyResult> = {
  name: 'inventory.stockpolicy',
  input: inventoryStockPolicyInput,
  roles: ['owner'],
  async handler(ctx, tx, input: InventoryStockPolicyInput) {
    if (input.goodsLeaveWith !== undefined) {
      return setGoodsLeaveWithInTransaction(ctx.db, tx, {
        workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, value: input.goodsLeaveWith,
      });
    }
    return setNegativeStockPolicyInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, refuse: input.refuseNegativeStock as boolean,
    });
  },
  async preview(ctx, input: InventoryStockPolicyInput) {
    if (input.goodsLeaveWith !== undefined) {
      return {
        title: 'Choose when stock leaves',
        lines: [
          `Today: stock leaves with ${ctx.workspace.goodsLeaveWith === 'delivery' ? 'deliveries' : 'the invoice'}`,
          `After: stock leaves with ${input.goodsLeaveWith === 'delivery' ? 'deliveries' : 'the invoice'}`,
          'Going back to invoices shipping the goods is refused while an order is part-way',
        ],
      };
    }
    return {
      title: 'Choose whether sales may take stock below zero',
      lines: [
        `Today: ${ctx.workspace.refuseNegativeStock === true ? 'refused' : 'allowed, with a warning'}`,
        `After: ${input.refuseNegativeStock ? 'refused' : 'allowed, with a warning'}`,
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'STOCK_POLICY_SET',
      entityType: 'workspaces',
      entityId: '',
      description: 'goodsLeaveWith' in result
        ? (result.goodsLeaveWith === 'delivery' ? 'Stock now leaves with deliveries (invoices book no cost of goods)' : 'Stock leaves with the invoice again')
        : (result.refuseNegativeStock ? 'Sales that would take stock below zero are now refused' : 'Sales may take stock below zero again (with a warning)'),
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'An owner chooses whether a sale may take stock below zero, or whether stock leaves with the invoice or with the delivery; do not use it to change stock quantities.',
    example: { refuseNegativeStock: true },
    refusals: [
      { code: 'INVALID_INPUT', when: 'Neither setting, or both, are sent.', next: 'Send { refuseNegativeStock: true|false } or { goodsLeaveWith: "invoice"|"delivery" }.' },
      { code: 'CONFLICT', when: 'An order is part-way, so invoices shipping the goods again would ship twice.', next: 'Finish or undo the delivery first.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner.', next: 'Ask an owner to change this.' },
    ],
  },
};

// --------------------------------------------------------------------------- deliveries

const deliveryLines = z.array(z.object({ position: z.number().int().min(0), quantity: z.number().finite() }).strict()).min(1).max(500);

export const inventoryDeliverInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  orderId: z.string().min(1),
  deliveryId: z.string().regex(DELIVERY_ID, 'Unknown delivery id'),
  date: DAY,
  lines: deliveryLines,
  inventoryAccountId: z.string().min(1),
  cogsAccountId: z.string().min(1),
  locationId: z.string().trim().max(200).optional(),
  note: z.string().max(200).optional(),
}).strict();
type InventoryDeliverInput = z.output<typeof inventoryDeliverInput>;

export const inventoryReturnInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  orderId: z.string().min(1),
  returnId: z.string().regex(RETURN_ID, 'Unknown return id'),
  date: DAY,
  lines: deliveryLines,
  inventoryAccountId: z.string().min(1),
  cogsAccountId: z.string().min(1),
  note: z.string().max(200).optional(),
}).strict();
type InventoryReturnInput = z.output<typeof inventoryReturnInput>;

export const inventoryUndoDeliveryInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  orderId: z.string().min(1),
  deliveryId: z.string().regex(DELIVERY_ID, 'Unknown delivery id'),
  date: DAY,
}).strict();
type InventoryUndoDeliveryInput = z.output<typeof inventoryUndoDeliveryInput>;

type DeliveryResult = { deliveryId: string; transactionIds: string[]; warnings: string[]; repeated: boolean };
type ReturnResult = { returnId: string; transactionIds: string[]; repeated: boolean };
type UndoDeliveryResult = { deliveryId: string; reversed: string[] };

export const inventoryDeliverCommand: CommandDefinition<typeof inventoryDeliverInput, DeliveryResult, DeliveryAccounts> = {
  name: 'inventory.deliver',
  input: inventoryDeliverInput,
  roles: STOCK_ROLES,
  dated: 'date',
  async prepare(ctx, input: InventoryDeliverInput) {
    return prepareDeliverOrder(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email });
  },
  async handler(ctx, tx, input: InventoryDeliverInput) {
    return deliverOrderInTransaction(ctx.db, tx, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }, ctx.prepared as DeliveryAccounts);
  },
  async preview(ctx, input: InventoryDeliverInput) {
    const prepared = await prepareDeliverOrder(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor });
    return {
      title: `Deliver from order ${input.orderId}`,
      lines: [
        `${input.lines.length} line(s), ${input.lines.reduce((sum, line) => sum + line.quantity, 0)} unit(s)`,
        `Cost of goods sold: ${prepared.cogsAcc.name}`,
        'Stock leaves and its cost is booked once per line; never more than is left to deliver',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'GOODS_DELIVERED',
      entityType: 'estimates',
      entityId: '',
      description: `Delivered ${result.transactionIds.length} line(s)${result.repeated ? ' (a repeated request)' : ''}`,
      details: { deliveryId: result.deliveryId, transactionIds: result.transactionIds, warnings: result.warnings },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Deliver units from an accepted order: stock leaves and the cost of those units is booked, never more than is left to deliver; do not use it in a workspace where the invoice ships the goods.',
    example: { orderId: 'est_123', deliveryId: 'dlv_abcdef12', date: '2026-11-01', lines: [{ position: 0, quantity: 2 }], inventoryAccountId: 'acc_inventory', cogsAccountId: 'acc_cogs' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A line, an account or an id is malformed, or the two accounts match.', next: 'Fix the named field.' },
      { code: 'NOT_FOUND', when: 'The order or an item is not in this workspace.', next: 'Use an order and items of this workspace.' },
      { code: 'CONFLICT', when: 'The workspace ships with invoices, the order is still a quote, or more is sent than is left.', next: 'Check the shipping setting and the quantity left on the line.' },
      { code: 'PERIOD_LOCKED', when: 'The date falls in a closed period.', next: 'Use a date in an open period.' },
    ],
  },
};

export const inventoryReturnCommand: CommandDefinition<typeof inventoryReturnInput, ReturnResult, DeliveryAccounts> = {
  name: 'inventory.return',
  input: inventoryReturnInput,
  roles: STOCK_ROLES,
  dated: 'date',
  async prepare(ctx, input: InventoryReturnInput) {
    return prepareReturnDelivered(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email });
  },
  async handler(ctx, tx, input: InventoryReturnInput) {
    return returnDeliveredInTransaction(ctx.db, tx, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }, ctx.prepared as DeliveryAccounts);
  },
  async preview(ctx, input: InventoryReturnInput) {
    const prepared = await prepareReturnDelivered(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor });
    return {
      title: `Take back units from order ${input.orderId}`,
      lines: [
        `${input.lines.reduce((sum, line) => sum + line.quantity, 0)} unit(s) come back in`,
        `Cost of goods sold is taken back from ${prepared.cogsAcc.name}`,
        'Never more than was delivered and kept',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'GOODS_RETURNED',
      entityType: 'estimates',
      entityId: '',
      description: `Took back ${result.transactionIds.length} line(s)${result.repeated ? ' (a repeated request)' : ''}`,
      details: { returnId: result.returnId, transactionIds: result.transactionIds },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Record goods that came back after a delivery: the units come back in and the cost booked for them is taken back; do not use it to deliver new units.',
    example: { orderId: 'est_123', returnId: 'ret_abcdef12', date: '2026-11-02', lines: [{ position: 0, quantity: 1 }], inventoryAccountId: 'acc_inventory', cogsAccountId: 'acc_cogs' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A line, an account or an id is malformed.', next: 'Fix the named field.' },
      { code: 'CONFLICT', when: 'More comes back than was delivered and kept.', next: 'Check what that line still has out.' },
      { code: 'PERIOD_LOCKED', when: 'The date falls in a closed period.', next: 'Use a date in an open period.' },
    ],
  },
};

export const inventoryUndoDeliveryCommand: CommandDefinition<typeof inventoryUndoDeliveryInput, UndoDeliveryResult> = {
  name: 'inventory.undodelivery',
  input: inventoryUndoDeliveryInput,
  roles: STOCK_ROLES,
  dated: 'date',
  async prepare(ctx, input: InventoryUndoDeliveryInput) {
    await prepareUndoDelivery(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email });
  },
  async handler(ctx, tx, input: InventoryUndoDeliveryInput) {
    return undoDeliveryInTransaction(ctx.db, tx, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email });
  },
  async preview(ctx, input: InventoryUndoDeliveryInput) {
    await prepareUndoDelivery(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor });
    return {
      title: 'Undo a delivery',
      lines: [`Delivery ${input.deliveryId} of order ${input.orderId}`, 'Its entries are reversed and the units come back'],
    };
  },
  audit(_input, result) {
    return {
      action: 'DELIVERY_UNDONE',
      entityType: 'estimates',
      entityId: '',
      description: `Undid delivery ${result.deliveryId}: ${result.reversed.length} entry(ies) reversed`,
      details: { deliveryId: result.deliveryId, reversed: result.reversed },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo a delivery: its cost entries are reversed and the units come back; do not use it once the delivery has been invoiced.',
    example: { orderId: 'est_123', deliveryId: 'dlv_abcdef12', date: '2026-11-03' },
    refusals: [
      { code: 'NOT_FOUND', when: 'That delivery is not on this order.', next: 'Check the delivery id on the order.' },
      { code: 'PERIOD_LOCKED', when: 'The date falls in a closed period.', next: 'Use a date in an open period.' },
    ],
  },
};

// --------------------------------------------------------------------------- inventory.transfer

export const inventoryTransferInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  itemId: z.string().min(1),
  from: z.string().trim().max(200),
  to: z.string().trim().max(200),
  quantity: z.number().positive().finite(),
  date: DAY,
  note: z.string().max(200).optional(),
}).strict();
type InventoryTransferInput = z.output<typeof inventoryTransferInput>;

type TransferResult = { moved: number; from: string; to: string };

export const inventoryTransferCommand: CommandDefinition<typeof inventoryTransferInput, TransferResult> = {
  name: 'inventory.transfer',
  input: inventoryTransferInput,
  roles: STOCK_ROLES,
  dated: 'date',
  async prepare(ctx, input: InventoryTransferInput) {
    await prepareTransferStock(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email });
  },
  async handler(ctx, tx, input: InventoryTransferInput) {
    return transferStockInTransaction(ctx.db, tx, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email });
  },
  async preview(ctx, input: InventoryTransferInput) {
    await prepareTransferStock(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor });
    return {
      title: 'Move stock between locations',
      lines: [
        `${input.quantity} unit(s) of ${input.itemId}`,
        `From ${groupIdLike(input.from) || 'no location'} to ${groupIdLike(input.to) || 'no location'}`,
        'Nothing is posted: the same Inventory account holds both',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'STOCK_MOVED',
      entityType: 'inventory',
      entityId: '',
      description: `Moved ${result.moved} from ${result.from || 'no location'} to ${result.to || 'no location'}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Move units of an item between two locations; the total on hand and the books do not change. Do not use it to add or remove stock — that is inventory.adjust.',
    example: { itemId: 'item_123', from: 'Warehouse', to: 'Shop', quantity: 3, date: '2026-11-01' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The quantity is not positive, or the two locations are the same.', next: 'Send a positive quantity and two different locations.' },
      { code: 'NOT_FOUND', when: 'The item is not in this workspace.', next: 'Use an item of this workspace.' },
      { code: 'CONFLICT', when: 'There are fewer units at the "from" location.', next: 'Check what is at that location first.' },
    ],
  },
};

// --------------------------------------------------------------------------- inventory.stockclosing

export const inventoryStockClosingInput = z.object({ asOf: DAY.optional() }).strict();
type InventoryStockClosingInput = z.output<typeof inventoryStockClosingInput>;

type StockClosingResult = { closing: Record<string, unknown> };

export const inventoryStockClosingCommand: CommandDefinition<typeof inventoryStockClosingInput, StockClosingResult> = {
  name: 'inventory.stockclosing',
  input: inventoryStockClosingInput,
  roles: ['owner'],
  dated: 'asOf',
  async prepare(ctx) {
    await prepareStockClosing(ctx.db);
  },
  async handler(ctx, tx, input: InventoryStockClosingInput) {
    const closing = await writeStockClosingInTransaction(ctx.db, tx, { workspaceId: ctx.workspaceId, asOf: input.asOf, uid: ctx.actor });
    return { closing: { ...closing } };
  },
  async preview(ctx, input: InventoryStockClosingInput) {
    await prepareStockClosing(ctx.db);
    const lockDate = typeof ctx.workspace.lockDate === 'string' ? ctx.workspace.lockDate : '';
    return {
      title: 'Take the stock closing',
      lines: [
        `At ${input.asOf || lockDate || 'the lock date'}`,
        'The stock, its history and the books are checked against each other',
        'The period must already be locked through that day',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'STOCK_CLOSING_TAKEN',
      entityType: 'stockClosings',
      entityId: String(result.closing.asOf || ''),
      description: `Took the stock closing at ${String(result.closing.asOf || '')}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Take the stock closing of a locked period end, which checks the stock history against the books; do not use it before the period is locked.',
    example: { asOf: '2026-10-31' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The day is not YYYY-MM-DD.', next: 'Send the day as YYYY-MM-DD.' },
      { code: 'CONFLICT', when: 'The books are not locked through that day, or part of it was unlocked again.', next: 'Lock the period first.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner.', next: 'Ask an owner to take the closing.' },
    ],
  },
};

// --------------------------------------------------------------------------- inventory.landedcost

/** The legacy landed-cost body, minus the workspace (the runner's) and with the plan review optional. */
export const inventoryLandedCostInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).optional(),
  charge: z.union([
    z.object({ kind: z.literal('bill'), billId: z.string().min(1), line: z.number().int().min(0) }).strict(),
    z.object({
      kind: z.literal('manual'), amountCents: z.number().int().positive(), accountId: z.string().min(1),
      allocationId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'allocationId: 8–80 letters, digits, - or _'), description: z.string().trim().max(200).optional(),
    }).strict(),
  ]),
  receiptBillIds: z.array(z.string().min(1)).min(1, 'Choose at least one bill whose goods were received').max(50),
  basis: z.enum(['value', 'quantity', 'weight']),
  weights: z.record(z.string(), z.number().nonnegative()).optional(),
  date: DAY.optional(),
  inventoryAccountId: z.string().min(1).optional(),
  cogsAccountId: z.string().min(1).optional(),
  expectedPlanHash: z.string().regex(/^[0-9a-f]{32}$/, 'expectedPlanHash: the planHash of the reviewed plan').optional(),
  dryRun: z.boolean().optional(),
}).strict();
type InventoryLandedCostInput = z.output<typeof inventoryLandedCostInput>;

export const inventoryLandedCostUndoInput = z.object({ entryId: z.string().min(1) }).strict();
type InventoryLandedCostUndoInput = z.output<typeof inventoryLandedCostUndoInput>;

const landedCostFor = (ctx: { workspaceId: string; actor: string; email?: string; user: { admin?: boolean } }, input: InventoryLandedCostInput): LandedCostInput => ({
  ...input,
  workspaceId: ctx.workspaceId,
  user: { uid: ctx.actor, email: ctx.email, admin: ctx.user.admin },
} as LandedCostInput);

export const inventoryLandedCostCommand: CommandDefinition<typeof inventoryLandedCostInput, Record<string, unknown>> = {
  name: 'inventory.landedcost',
  input: inventoryLandedCostInput,
  roles: ['owner', 'accountant'],
  dated: 'date',
  async prepare(ctx, input: InventoryLandedCostInput) {
    // a dry run only calculates the plan: it writes nothing, so the command runner treats it as a preview
    if (!input.dryRun) await prepareLandedCost(ctx.db, landedCostFor(ctx, input));
  },
  async handler(ctx, tx, input: InventoryLandedCostInput) {
    const result = await landInTransaction(ctx.db, tx, landedCostFor(ctx, input));
    return { ...result };
  },
  async preview(ctx, input: InventoryLandedCostInput) {
    await prepareLandedCost(ctx.db, landedCostFor(ctx, input));
    return {
      title: 'Land a cost on received goods',
      lines: [
        input.charge.kind === 'manual' ? `${money(input.charge.amountCents)} over ${input.receiptBillIds.length} bill(s)` : `A bill line over ${input.receiptBillIds.length} bill(s)`,
        `Spread by ${input.basis}`,
        input.expectedPlanHash ? 'The plan must still match the one reviewed' : 'The plan is worked out when it posts',
      ],
    };
  },
  audit(_input, result) {
    const entryId = String(result.entryId || '');
    return {
      action: 'LANDED_COST_POSTED',
      entityType: 'transaction',
      entityId: entryId,
      description: `Landed a cost (entry ${entryId})`,
    };
  },
  inverse(_input, result) {
    const entryId = String(result.entryId || '');
    return entryId ? { command: 'inventory.landedcostundo', input: { entryId } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Spread a freight, duty or other cost over the bills whose goods it brought in, raising those items\' cost; do not use it to pay the charge — that is a bill or a payment.',
    example: { charge: { kind: 'manual', amountCents: 12000, accountId: 'acc_freight', allocationId: 'alloc_20261101', description: 'Freight' }, receiptBillIds: ['bill_123'], basis: 'value' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The charge, the basis or the allocation id is malformed.', next: 'Fix the named field.' },
      { code: 'CONFLICT', when: 'The plan changed since it was reviewed, or there is nothing left to allocate.', next: 'Review the plan again and post it.' },
    ],
  },
};

export const inventoryLandedCostUndoCommand: CommandDefinition<typeof inventoryLandedCostUndoInput, Record<string, unknown>> = {
  name: 'inventory.landedcostundo',
  input: inventoryLandedCostUndoInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: InventoryLandedCostUndoInput) {
    const undoInput: LandedCostUndoInput = { workspaceId: ctx.workspaceId, user: { uid: ctx.actor, email: ctx.email, admin: ctx.user.admin }, entryId: input.entryId };
    return { ...(await undoLandedCostInTransaction(ctx.db, tx, undoInput)) };
  },
  async preview(ctx, input: InventoryLandedCostUndoInput) {
    return {
      title: 'Undo a landed cost',
      lines: [`Entry ${input.entryId}`, 'Its entry and its stock moves are reversed together'],
    };
  },
  audit(_input, result) {
    return {
      action: 'LANDED_COST_UNDONE',
      entityType: 'transaction',
      entityId: String(result.entryId || ''),
      description: `Undid landed cost ${String(result.entryId || '')}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo a landed cost, reversing its entry and its stock moves together; do not use it to undo an ordinary bill or journal entry.',
    example: { entryId: 'landed-cost-abc123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'That entry is not a landed cost of this workspace.', next: 'Check the entry id.' },
    ],
  },
};
