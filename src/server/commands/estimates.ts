import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import { getLocalDateISO } from '../../lib/calendarDate';
import { nextPoNumber } from '../../lib/purchaseOrderNumbering';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A quote, and the milestones that bill it — the seven writes `EstimatesView` made by hand.
 *
 * The screen created a quote with `addDoc`, put it through four status moves with `updateDoc` (`accepted` when the
 * customer said yes, `declined`, and `converted` twice: once for a whole-order invoice and once for the last part of a
 * part-invoiced order), and `MilestoneSchedule` / `OrderInvoiceDialog` rewrote the milestone list on the row. Every one
 * of them typed `updatedAt` from the tab, none of them left an audit line, and an estimate id from another workspace
 * was an update anyone could send.
 *
 * Two commands, because there are two things a person does:
 *
 * - `estimate.save` writes the quote itself — a new one (no `id`, with the number the series gave it) or a change to
 *   the terms and lines of one that is still open, and the milestone schedule, which is part of the terms.
 * - `estimate.status` moves a quote through the stages the screen calls: accepted (it becomes an order, with the
 *   customer's reference and who accepted it), declined, or converted (with the invoice it became). Conversion is a
 *   one-way door: a converted estimate cannot go back to a quote, because an invoice already points at it.
 *
 * What it is **not**: an invoice. `estimate.status` with `converted` records which invoice took the quote over; the
 * invoice itself is created by `invoice.create` (the screen calls it first and passes the id here). Nothing here posts,
 * moves a balance or changes a report figure — an estimate is a promise, not a posting.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD');

const lineSchema = z.object({
  itemId: text(200).optional(),
  /** W-08: the vendor buys the units and ships them straight to the customer (no stock moves) */
  dropShip: z.boolean().optional(),
  description: text(300).min(1),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: cents,
  amountCents: cents,
}).strict();

/** A milestone is a share of the order with an optional date; invoicing one writes `invoicedAt`. */
const milestoneSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: text(80).min(1),
  percent: z.number().positive().max(100),
  due: day.optional(),
  invoicedAt: z.string().trim().max(40).optional(),
}).strict();

const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'converted', 'expired'] as const;

export const estimateSaveInput = z.object({
  /** absent when a new quote is written; present when its terms or milestones change */
  id: idSchema.optional(),
  /** the number the estimate series gave it; required for a new quote, never re-chosen for an existing one */
  number: text(40).optional(),
  /** required when the quote is written (no `id`); a change may name only what it touches */
  customerId: text(200).min(1).optional(),
  customerName: text(200).min(1).optional(),
  date: day.optional(),
  expiryDate: day.optional(),
  amountCents: cents.optional(),
  currency: text(8).min(3).max(8).optional(),
  description: text(400).optional(),
  status: z.enum(STATUSES).optional(),
  lines: z.array(lineSchema).max(500).optional(),
  milestones: z.array(milestoneSchema).max(20).optional(),
}).strict();

export const estimateStatusInput = z.object({
  id: idSchema,
  status: z.enum(['accepted', 'declined', 'converted']),
  /** the customer's own reference, for an accepted order */
  customerReference: text(100).optional(),
  /** the invoice that took the order over, for `converted` */
  convertedInvoiceId: idSchema.optional(),
}).strict();

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type SaveInput = z.output<typeof estimateSaveInput>;
type StatusInput = z.output<typeof estimateStatusInput>;
type EstimateRow = Record<string, unknown> & { id?: string; status?: string };
export type EstimateSaved = { id: string; created: boolean; status: string };

/** Stages a quote can still be rewritten in: once an order is accepted, its terms are what the customer agreed to. */
const EDITABLE = new Set(['draft', 'sent']);

export const estimateSaveCommand: CommandDefinition<typeof estimateSaveInput, EstimateSaved> = {
  name: 'estimate.save',
  input: estimateSaveInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: SaveInput) {
    const now = new Date().toISOString();
    if (!input.id) {
      const missing = ['number', 'customerId', 'customerName', 'date', 'expiryDate', 'amountCents', 'currency']
        .filter(key => input[key as keyof SaveInput] === undefined);
      if (missing.length > 0) {
        throw Object.assign(new HttpError(
          `A new quote needs the number its series gave it and its terms: ${missing.join(', ')}.`,
          400,
        ), { code: 'INVALID_INPUT' });
      }
      // the create branch took any stage: `status: 'accepted'` would open an order with no acceptance date, no
      // accepter and no invoice behind it, walking around every rule `estimate.status` keeps. A quote is born a
      // draft (or already sent, if it was issued straight away); the rest is the stage command's.
      if (input.status !== undefined && !EDITABLE.has(input.status)) {
        throw Object.assign(new HttpError(
          'A new quote starts as a draft; accept, decline or convert it with estimate.status.',
          409,
        ), { code: 'CONFLICT' });
      }
      const ref = ctx.db.collection('estimates').doc();
      const id = (ref as unknown as { id: string }).id;
      const { id: _id, ...fields } = input;
      tx.set(ref, {
        ...fields,
        id,
        uid: ctx.actor,
        workspaceId: ctx.workspaceId,
        status: input.status || 'draft',
        createdAt: now,
        updatedAt: now,
      });
      return { id, created: true, status: input.status || 'draft' };
    }
    const ref = ctx.db.collection('estimates').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This quote is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    // the stage is `estimate.status`'s to move: a save that wrote `status` would have walked around every rule
    // that command keeps (an accepted order cannot become a quote again, a converted one cannot go back, and the
    // acceptance's date and person are stamped from the session, not from the payload)
    if (input.status !== undefined && input.status !== String(existing.status || 'draft')) {
      throw Object.assign(new HttpError(
        `This quote is ${String(existing.status || 'draft')}: its stage is changed by accepting, declining or converting it, not by saving its terms.`,
        409,
      ), { code: 'CONFLICT' });
    }
    if (!EDITABLE.has(String(existing.status || 'draft')) && (input.lines !== undefined || input.amountCents !== undefined)) {
      throw Object.assign(new HttpError(
        `This quote is ${String(existing.status)}, so its lines and total are what the customer agreed to; a change to them is a new quote.`,
        409,
      ), { code: 'CONFLICT' });
    }
    const { id: _id, number: _number, ...fields } = input;
    tx.update(ref, { ...fields, updatedAt: now });
    return { id: input.id, created: false, status: String(fields.status || existing.status || 'draft') };
  },
  async preview(ctx: CommandContext, input: SaveInput) {
    if (!input.id) return { title: `Write quote ${input.number || ''}`, lines: [input.customerName || 'A new quote', `${input.status || 'draft'}, expires ${input.expiryDate || '—'}`] };
    const snapshot = await ctx.db.collection('estimates').doc(input.id).get();
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This quote is not in the selected workspace.', 404);
    }
    return {
      title: `Change quote ${String(existing?.number || input.id)}`,
      lines: [input.customerName || String(existing?.customerName || ''), `expires ${input.expiryDate || String(existing?.expiryDate || '—')}`],
    };
  },
  audit(_input: SaveInput, result: EstimateSaved) {
    return {
      action: result.created ? 'ESTIMATE_CREATED' : 'ESTIMATE_UPDATED',
      entityType: 'estimates',
      entityId: result.id,
      description: `${result.created ? 'Wrote' : 'Changed'} the quote ${result.id} (${result.status})`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Write a quote or change its terms, lines and milestone schedule while it is still a quote; do not use it to invoice it, which invoice.create does.',
    example: { number: 'EST-1042', customerId: 'cust_1', customerName: 'Acme', date: '2026-11-16', expiryDate: '2026-12-16', amountCents: 250000, currency: 'USD' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A line, a milestone (>20, adding past 100%) or a date is not one the screen could have produced, or a new quote has no number.', next: 'Send the number the series gave it, whole cents, and dates as YYYY-MM-DD.' },
      { code: 'CONFLICT', when: 'The quote is already accepted, declined or converted and the change touches its lines or total.', next: 'Write a new quote; an accepted order\'s terms are what the customer agreed to.' },
      { code: 'NOT_FOUND', when: 'The quote is not in the selected workspace.', next: 'Reload the quotes and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to write the quote.' },
    ],
    next: [{ command: 'estimate.status', label: 'Accept, decline or convert it' }],
  },
};

export const estimateStatusCommand: CommandDefinition<typeof estimateStatusInput, EstimateSaved> = {
  name: 'estimate.status',
  input: estimateStatusInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: StatusInput) {
    const ref = ctx.db.collection('estimates').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This quote is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const current = String(existing.status || 'draft');
    if (current === 'converted' && input.status !== 'converted') {
      throw Object.assign(new HttpError(
        'This quote became an invoice already; it cannot go back to being a quote or an order.',
        409,
      ), { code: 'CONFLICT' });
    }
    if (input.status === 'converted' && !input.convertedInvoiceId) {
      throw Object.assign(new HttpError('A converted quote names the invoice that took it over.', 400), { code: 'INVALID_INPUT' });
    }
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: input.status, updatedAt: now };
    if (input.status === 'accepted') {
      patch.orderedAt = now;
      patch.orderedBy = ctx.actor;
      if (input.customerReference) patch.customerReference = input.customerReference;
    }
    if (input.status === 'converted') patch.convertedInvoiceId = input.convertedInvoiceId;
    tx.update(ref, patch);
    return { id: input.id, created: false, status: input.status };
  },
  async preview(ctx: CommandContext, input: StatusInput) {
    const snapshot = await ctx.db.collection('estimates').doc(input.id).get();
    const existing = snapshot.data() as EstimateRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This quote is not in the selected workspace.', 404);
    }
    return {
      title: `Mark quote ${String(existing?.number || input.id)} ${input.status}`,
      lines: [
        input.status === 'accepted' ? 'It becomes an order that can be invoiced in parts' : `It is marked ${input.status}`,
        ...(input.convertedInvoiceId ? [`The invoice that took it over: ${input.convertedInvoiceId}`] : []),
      ],
    };
  },
  audit(_input: StatusInput, result: EstimateSaved) {
    return {
      action: 'ESTIMATE_STATUS',
      entityType: 'estimates',
      entityId: result.id,
      description: `Marked quote ${result.id} ${result.status}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Accept a quote as an order, decline it, or record the invoice that converted it; do not use it to create the invoice, which invoice.create does first.',
    example: { id: 'est_1', status: 'accepted', customerReference: 'PO-4471' },
    refusals: [
      { code: 'CONFLICT', when: 'The quote is already converted, or the stage it is in cannot go to the one asked for.', next: 'Write a new quote, or invoice the order instead of re-staging it.' },
      { code: 'INVALID_INPUT', when: 'A conversion does not name the invoice that took the quote over.', next: 'Create the invoice first, then pass its id.' },
      { code: 'NOT_FOUND', when: 'The quote is not in the selected workspace.', next: 'Reload the quotes and choose one in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to move it.' },
    ],
    next: [{ command: 'estimate.save', label: 'Change its terms' }],
  },
};

/** A command refusal: the message the caller sees, the HTTP status and the machine code. */
const commandError = (message: string, status: number, code: string): never => {
  throw Object.assign(new HttpError(message, status), { code });
};

export const estimateDropshipInput = z.object({
  id: idSchema,
  vendorId: idSchema,
}).strict();
type DropshipInput = z.output<typeof estimateDropshipInput>;
type DropshipEstimateRow = EstimateRow & {
  number?: string;
  currency?: string;
  orderedAt?: string;
  lines?: Array<{ dropShip?: boolean; itemId?: string; description?: string; quantity?: number; unitPriceCents?: number; amountCents?: number }>;
  metadata?: Record<string, unknown>;
};
export type EstimateDropshipResult = { id: string; poNumber: string; totalAmountCents: number; lines: number };

// W-08 drop-ship: one PO from the order's drop-ship lines, at their prices, with no stock item on its
// lines (so the bill from the order brings no units in). The order keeps the link to its PO.
/** the accepted order to place the PO from, or a 404 when it is missing or outside the workspace */
async function dropshipOrder(ctx: CommandContext, input: DropshipInput) {
  const snapshot = await ctx.db.collection('estimates').doc(input.id).get();
  const est = snapshot.data() as DropshipEstimateRow | undefined;
  if (!snapshot.exists || est?.workspaceId !== ctx.workspaceId) commandError('Quote not in this workspace.', 404, 'NOT_FOUND');
  return est!;
}

export const estimateDropshipCommand: CommandDefinition<typeof estimateDropshipInput, EstimateDropshipResult> = {
  name: 'estimate.dropship',
  input: estimateDropshipInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: DropshipInput) {
    const now = new Date().toISOString();
    const est = await dropshipOrder(ctx, input);
    // the order must be accepted now: a declined (or converted) order keeps its acceptance date, but it is
    // closed — fulfilment actions are suppressed for it, and placing a drop-ship PO would buy for a dead order
    if (String(est.status || '') !== 'accepted' || !est?.orderedAt) commandError('Only accepted orders drop-ship.', 409, 'CONFLICT');
    const dropLines = (est.lines || []).filter(l => l.dropShip);
    if (dropLines.length === 0) commandError('No drop-ship lines to buy.', 400, 'INVALID_INPUT');
    if (dropLines.some(l => !(Number(l.quantity) > 0) || !(Number(l.amountCents) > 0))) commandError('Drop-ship lines need quantity and amount.', 400, 'INVALID_INPUT');
    const vendorSnap = await tx.get(ctx.db.collection('vendors').doc(input.vendorId));
    const vendor = vendorSnap.data() as { workspaceId?: string; name?: string } | undefined;
    if (!vendorSnap.exists || !vendor || vendor.workspaceId !== ctx.workspaceId) commandError('Vendor not in this workspace.', 404, 'NOT_FOUND');
    // one drop-ship PO per order: placing it twice would double-buy the same units
    const rows = ((await tx.get(ctx.db.collection('purchaseOrders').where('workspaceId', '==', ctx.workspaceId)) as unknown as { docs: Array<{ data(): Record<string, unknown> | undefined }> }).docs
      .map(d => d.data() || {}));
    if (rows.some(po => (po.metadata as Record<string, unknown> | undefined)?.estimateId === input.id)) commandError('A drop-ship order for this order already exists.', 409, 'CONFLICT');
    const issueDate = getLocalDateISO();
    const items = dropLines.map((line, i) => {
      const quantity = Number(line.quantity);
      const unitPriceCents = Math.round(Number(line.unitPriceCents) || 0);
      return { id: `${est.id}-po-${i + 1}`, description: line.description || 'Drop-ship line', quantity, unitPriceCents, totalCents: Math.round(quantity * unitPriceCents) };
    });
    const totalCents = items.reduce((sum, i) => sum + i.totalCents, 0);
    const poRef = ctx.db.collection('purchaseOrders').doc();
    const poId = (poRef as unknown as { id: string }).id;
    const poNumber = nextPoNumber(rows.map(po => ({ poNumber: String(po.poNumber || '') })), issueDate.slice(0, 4));
    tx.set(poRef, { id: poId, uid: ctx.actor, workspaceId: ctx.workspaceId, poNumber, vendorId: input.vendorId, vendorName: vendor?.name || 'Vendor', issueDate, currency: String(est.currency || ctx.workspace.currency || 'USD'), status: 'draft', items, totalAmountCents: totalCents, metadata: { estimateId: est.id, estimateNumber: est.number || est.id, dropShip: true }, createdAt: now, updatedAt: now });
    tx.update(ctx.db.collection('estimates').doc(input.id), { metadata: { ...(est.metadata || {}), dropShipPoId: poId }, updatedAt: now });
    return { id: poId, poNumber, totalAmountCents: totalCents, lines: items.length };
  },
  async preview(ctx: CommandContext, input: DropshipInput) {
    const est = await dropshipOrder(ctx, input);
    const dropLines = (est.lines || []).filter(l => l.dropShip);
    return {
      title: `Drop-ship purchase order for order ${String(est.number || input.id)}`,
      lines: [
        `${dropLines.length} drop-ship line${dropLines.length === 1 ? '' : 's'}, no stock moves`,
        `${dropLines.reduce((sum, l) => sum + Math.round(Number(l.amountCents) || 0), 0)} cents`,
      ],
    };
  },
  audit(_input: DropshipInput, result: EstimateDropshipResult) {
    return { action: 'ESTIMATE_DROPSHIP', entityType: 'purchaseOrders', entityId: result.id, description: `Drop-ship PO ${result.poNumber}: ${result.lines} line(s), ${result.totalAmountCents} cents` };
  },
  risk: 'normal',
  describe: {
    sentence: 'Place one vendor purchase order for a sales order drop-ship lines; the units ship direct, never entering stock.',
    example: { id: 'est_1', vendorId: 'vendor_1' },
    refusals: [
      { code: 'CONFLICT', when: 'Not an accepted order, or a drop-ship order exists.', next: 'Accept it first, or use the existing one.' },
      { code: 'INVALID_INPUT', when: 'No drop-ship lines, or a line lacks quantity or amount.', next: 'Mark lines to drop-ship, with prices.' },
      { code: 'NOT_FOUND', when: 'The order or vendor is not in this workspace.', next: 'Choose ones here.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};
